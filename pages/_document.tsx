import { Html, Head, Main, NextScript } from "next/document";
import Script from "next/script";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <Script
          id="tailwind-config"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.tailwind = window.tailwind || {};
              window.tailwind.config = {
                darkMode: "class",
                theme: {
                  extend: {
                    fontFamily: {
                      sans: ["Inter", "system-ui", "sans-serif"],
                    },
                  },
                },
              };
            `,
          }}
        />
<<<<<<< HEAD
        <Script
          id="tailwind-runtime"
          src="https://cdn.tailwindcss.com?plugins=typography"
          strategy="beforeInteractive"
        />
      </Head>
      <body className="bg-slate-950 text-slate-100">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
