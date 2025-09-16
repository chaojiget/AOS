import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script
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
        <script async src="https://cdn.tailwindcss.com?plugins=typography"></script>
      </Head>
      <body className="bg-slate-950 text-slate-100">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
