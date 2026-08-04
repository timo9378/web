import { LocaleLink } from '@/i18n/locale-link';
import { useTranslation } from 'react-i18next';

const NotFound = () => {
  const { t } = useTranslation();
  return (
    <>
      <div style={{
        minHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        textAlign: 'center',
        padding: '2rem',
        position: 'relative',
        zIndex: 10,
      }}>
        <h1 style={{
          fontSize: 'clamp(5rem, 15vw, 10rem)',
          fontWeight: 800,
          background: 'linear-gradient(135deg, #7f5af0, #2cb67d)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          lineHeight: 1,
          marginBottom: '0.5rem',
          userSelect: 'none',
        }}>
          404
        </h1>
        <p style={{
          fontSize: 'clamp(1rem, 3vw, 1.5rem)',
          color: 'rgba(255,255,255,0.6)',
          marginBottom: '2rem',
          maxWidth: '480px',
        }}>
          {t('notFound.lostMessage')}
          <br />{t('notFound.subMessage')}
        </p>
        <LocaleLink
          to="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 2rem',
            borderRadius: '9999px',
            background: 'linear-gradient(135deg, #7f5af0, #2cb67d)',
            color: 'white',
            fontWeight: 600,
            fontSize: '1rem',
            textDecoration: 'none',
            transition: 'transform 0.2s, box-shadow 0.2s',
            boxShadow: '0 0 20px rgba(127, 90, 240, 0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.boxShadow = '0 0 30px rgba(127, 90, 240, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 0 20px rgba(127, 90, 240, 0.3)';
          }}
        >
          ← {t('notFound.backHome')}
        </LocaleLink>
      </div>
    </>
  );
};

export default NotFound;
