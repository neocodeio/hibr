import { InstagramIcon, NewTwitterIcon } from 'hugeicons-react';
import type { SocialLink, SocialPlatform } from '../../lib/socialLinks';
import { SOCIAL_PLATFORMS } from '../../lib/socialLinks';
import './SocialLinks.css';

export function SubstackGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z" />
    </svg>
  );
}

export function PlatformIcon({ platform, size = 16 }: { platform: SocialPlatform; size?: number }) {
  if (platform === 'x') return <NewTwitterIcon size={size} strokeWidth={1.75} aria-hidden="true" />;
  if (platform === 'instagram') return <InstagramIcon size={size} strokeWidth={1.75} aria-hidden="true" />;
  return <SubstackGlyph size={size} />;
}

interface SocialLinksProps {
  links: SocialLink[];
}

/** Public row of social icons shown on any profile (icons only, no text). */
function SocialLinks({ links }: SocialLinksProps) {
  if (links.length === 0) return null;
  return (
    <div className="social-links" aria-label="روابط التواصل">
      {links.map((link) => (
        <a
          key={link.platform}
          className="social-links__chip"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer me"
          aria-label={SOCIAL_PLATFORMS[link.platform].label}
          title={SOCIAL_PLATFORMS[link.platform].label}
        >
          <PlatformIcon platform={link.platform} size={16} />
        </a>
      ))}
    </div>
  );
}

export default SocialLinks;
