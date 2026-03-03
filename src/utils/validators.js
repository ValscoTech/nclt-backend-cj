export const isValidCINFormat = (cin) =>
  /^[A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(cin);
