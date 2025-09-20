import type { PropsWithChildren } from "react";
import React from "react";

export function Html({ children }: PropsWithChildren) {
  return <html>{children}</html>;
}

export function Head({ children }: PropsWithChildren) {
  return <head>{children}</head>;
}

export function Main() {
  return <main />;
}

export function NextScript() {
  return <script />;
}

export default { Html, Head, Main, NextScript };
