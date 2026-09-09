import { Link } from 'react-router-dom';
import { ArrowUp01Icon } from 'hugeicons-react';
import Logo from '../ui/Logo';
import './Footer.css';

function Footer() {
  const year = new Date().getFullYear();

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  return (
    <footer className="footer" role="contentinfo">
      <div className="footer__container">
        {/* Main Footer Navigation & Brand */}
        <div className="footer__main">
          {/* Brand Info */}
          <div className="footer__brand">
            <Link to="/" className="footer__logo-link" aria-label="حِبر - الرئيسية">
              <Logo />
            </Link>
            <p className="footer__description">
              مساحة مستقلة للقراءة والكتابة الجادة. نبتكر بيئة هادئة لإثراء الكلمة العربية ونشر الأفكار الرصينة.
            </p>
          </div>

          {/* Navigation Columns */}
          <nav className="footer__nav" aria-label="روابط الترويسة السفلية">
            <div className="footer__col">
              <h3 className="footer__col-title">استكشف</h3>
              <ul className="footer__col-links">
                <li><Link to="/" className="footer__link">الرئيسية</Link></li>
                <li><a href="#" className="footer__link">المقالات المختارة</a></li>
                <li><a href="#" className="footer__link">الكُتّاب</a></li>
              </ul>
            </div>

            <div className="footer__col">
              <h3 className="footer__col-title">عن حِبر</h3>
              <ul className="footer__col-links">
                <li><a href="#" className="footer__link">رؤيتنا</a></li>
                <li><a href="#" className="footer__link">دليل الكتابة</a></li>
                <li><a href="#" className="footer__link">الأسئلة الشائعة</a></li>
              </ul>
            </div>

            <div className="footer__col">
              <h3 className="footer__col-title">قانوني</h3>
              <ul className="footer__col-links">
                <li><a href="#" className="footer__link">الشروط والأحكام</a></li>
                <li><a href="#" className="footer__link">سياسة الخصوصية</a></li>
                <li><a href="#" className="footer__link">تواصل معنا</a></li>
              </ul>
            </div>
          </nav>
        </div>

        {/* Divider */}
        <div className="footer__divider" aria-hidden="true" />

        {/* Bottom Bar */}
        <div className="footer__bottom">
          <p className="footer__copyright">
            © {year} حِبر. جميع الحقوق محفوظة.
          </p>

          <p className="footer__tagline">
            اكتب ما يستحق أن يُقرأ
          </p>

          <button
            type="button"
            className="footer__back-top"
            onClick={scrollToTop}
            aria-label="العودة إلى أعلى الصفحة"
          >
            <span>الأعلى</span>
            <ArrowUp01Icon size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
    </footer>
  );
}

export default Footer;

