import { createFileRoute, notFound } from '@tanstack/react-router';
import { buildAlternateLinks, localeFromPrefix, LocaleProvider } from '../../start-i18n';
import { DEFAULT_LOCALE } from '../../lib/locales';
import MainPage from '../../components/MainPage';
import { siteJsonLd } from '../../seoMeta';
import { seoMetaFor } from '../../pageSeo';

// 帶前綴的 locale 首頁:/en、/ja、/ko、/zh-cn。
// 非支援前綴 → notFound;預設 zh-TW → notFound(走無前綴的 routes/index)。
export const Route = createFileRoute('/$locale/')({
  head: ({ params }) => {
    const locale = localeFromPrefix(params.locale) ?? DEFAULT_LOCALE;
    return {
      meta: seoMetaFor('', locale, `/${params.locale}`),
      scripts: [siteJsonLd(locale)],
      links: buildAlternateLinks('', locale),
    };
  },
  loader: ({ params }) => {
    const locale = localeFromPrefix(params.locale);
    if (!locale || locale === 'zh-TW') throw notFound();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const locale = localeFromPrefix(Route.useParams().locale) ?? DEFAULT_LOCALE;
  return (
    <LocaleProvider locale={locale}>
      <MainPage />
    </LocaleProvider>
  );
}
