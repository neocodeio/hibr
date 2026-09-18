-- ============================================================
-- HIBR — Chat (E2EE direct messages) Schema
-- Run this whole file once in Supabase SQL Editor. Safe to re-run.
-- Privacy model: the server ONLY stores ciphertext + IV. Plaintext
-- never leaves the browser (AES-GCM 256, keys derived via ECDH P-256
-- from per-user identity keys). There is deliberately NO plaintext,
-- NO server-side decryption, NO full-text index on message bodies.
--
-- ORDER MATTERS: tables are created before the helper function and
-- policies that reference them (Postgres validates SQL-language
-- functions and policies at creation time).
-- ============================================================

-- 1. Public identity key for E2EE (JWK: {kty,crv,x,y}). Public by design.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS public_key JSONB;

-- 2. Conversations table (DMs: exactly 2 participants, enforced in app).
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Participants table — created BEFORE the helper function below,
-- which reads from it (otherwise: 42P01 relation does not exist).
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

-- 4. Helper: is the caller a participant of this conversation?
-- SECURITY DEFINER so RLS on participants doesn't recurse infinitely.
CREATE OR REPLACE FUNCTION public.is_conversation_participant(conv_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants p
    WHERE p.conversation_id = conv_id
      AND p.user_id = (auth.jwt() ->> 'sub')
  );
$$;

-- 5. Conversations RLS + policies (after function: policies call it).
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view their conversations" ON public.conversations;
CREATE POLICY "Participants can view their conversations"
  ON public.conversations FOR SELECT
  USING (
    created_by = (auth.jwt() ->> 'sub')
    OR public.is_conversation_participant(id)
  );

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (created_by = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Participants can bump last message time" ON public.conversations;
CREATE POLICY "Participants can bump last message time"
  ON public.conversations FOR UPDATE
  USING (public.is_conversation_participant(id))
  WITH CHECK (public.is_conversation_participant(id));

DROP POLICY IF EXISTS "Creators can delete their conversations" ON public.conversations;
CREATE POLICY "Creators can delete their conversations"
  ON public.conversations FOR DELETE
  USING (created_by = (auth.jwt() ->> 'sub'));

-- 6. Participants RLS + policies.
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view participant rows" ON public.conversation_participants;
CREATE POLICY "Participants can view participant rows"
  ON public.conversation_participants FOR SELECT
  USING (
    user_id = (auth.jwt() ->> 'sub')
    OR public.is_conversation_participant(conversation_id)
  );

DROP POLICY IF EXISTS "Users can add participants" ON public.conversation_participants;
CREATE POLICY "Users can add participants"
  ON public.conversation_participants FOR INSERT
  WITH CHECK (
    -- You can always add yourself; you can add the peer only to a
    -- conversation you created (DM invite) or one you belong to.
    user_id = (auth.jwt() ->> 'sub')
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND c.created_by = (auth.jwt() ->> 'sub')
    )
    OR public.is_conversation_participant(conversation_id)
  );

-- No UPDATE needed; deletes only by own row or conversation creator.
DROP POLICY IF EXISTS "Users can leave conversations" ON public.conversation_participants;
CREATE POLICY "Users can leave conversations"
  ON public.conversation_participants FOR DELETE
  USING (
    user_id = (auth.jwt() ->> 'sub')
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND c.created_by = (auth.jwt() ->> 'sub')
    )
  );

CREATE INDEX IF NOT EXISTS conversation_participants_user_idx
  ON public.conversation_participants (user_id);
CREATE INDEX IF NOT EXISTS conversation_participants_conv_idx
  ON public.conversation_participants (conversation_id);

-- 7. Messages — CIPHERTEXT ONLY (E2EE). No plaintext column exists on purpose.
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL CHECK (char_length(ciphertext) BETWEEN 1 AND 20000),
  iv TEXT NOT NULL CHECK (char_length(iv) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can read messages" ON public.messages;
CREATE POLICY "Participants can read messages"
  ON public.messages FOR SELECT
  USING (public.is_conversation_participant(conversation_id));

DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
CREATE POLICY "Participants can send messages"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = (auth.jwt() ->> 'sub')
    AND public.is_conversation_participant(conversation_id)
  );

DROP POLICY IF EXISTS "Senders can delete their own messages" ON public.messages;
CREATE POLICY "Senders can delete their own messages"
  ON public.messages FOR DELETE
  USING (sender_id = (auth.jwt() ->> 'sub'));

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON public.messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS messages_sender_idx
  ON public.messages (sender_id);

-- 8. Keep conversations.last_message_at fresh on new message.
-- plpgsql validates the body at first execution, but the table already
-- exists by this point anyway.
CREATE OR REPLACE FUNCTION public.bump_conversation_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_conversation_last_message ON public.messages;
CREATE TRIGGER trg_bump_conversation_last_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_conversation_last_message();

-- 9. Realtime delivery (Supabase Realtime must have these tables).
-- Safe to re-run: only adds missing tables to the publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversation_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
  END IF;
END
$$;
