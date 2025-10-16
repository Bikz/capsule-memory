declare module '*.yaml' {
  const value: string;
  export default value;
}

declare module '*.yaml?raw' {
  const value: string;
  export default value;
}
