import type { AppProps } from "next/app";
import { I18nProvider } from "../lib/i18n/index";
import "../styles/globals.css";

const App = ({ Component, pageProps, router }: AppProps) => {
  const locale = router.locale ?? router.defaultLocale ?? undefined;
  return (
    <I18nProvider locale={locale}>
      <Component {...pageProps} />
    </I18nProvider>
  );
};

export default App;
