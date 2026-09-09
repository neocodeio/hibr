import { useTheme } from '../../lib/ThemeProvider';
import './Logo.css';

function Logo() {
  const { theme } = useTheme();
  const logoSrc = theme === 'dark' 
    ? '/hibr_logo2-removebg-white.png' 
    : '/hibr_logo2-removebg.png';

  return (
    <span className="logo" aria-label="حِبر">
      <img src={logoSrc} alt="حِبر" width={"80px"}/>
    </span>
  );
}

export default Logo;
