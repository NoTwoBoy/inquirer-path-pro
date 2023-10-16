declare module "run-async" {
  function runAsync<T, U extends Array<any>>(
    fn: (...args: U) => T
  ): (...args: U) => Promise<T>;
  export = runAsync;
}
