export function useRouter() {
  return {
    pathname: "/",
    query: {},
    push: async () => {},
    replace: async () => {},
    prefetch: async () => {},
    events: {
      on() {},
      off() {},
      emit() {},
    },
  };
}

export default { useRouter };
