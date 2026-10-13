// A hint, not a guarantee: columns whose names look like personal data or credentials start
// hidden on a connection's first snapshot. Names are split into words ("customerEmail" and
// "customer_email" both give customer, email) and only whole words or whole word sequences
// match, so "syntax_identifier" does not read as a tax id.

const PERSONAL_WORDS = new Set([
  'email',
  'emailaddress',
  'phone',
  'phonenumber',
  'mobile',
  'telephone',
  'cellphone',
  'msisdn',
  'fax',
  'address',
  'ssn',
  'passport',
  'aadhaar',
  'aadhar',
  'pan',
  'iban',
  'dob',
  'birthday',
  'birthdate',
  'dateofbirth',
  'nationalid',
  'taxid',
  'creditcard',
  'cardnumber',
]);

const PERSONAL_PHRASES = [
  ['date', 'of', 'birth'],
  ['birth', 'date'],
  ['national', 'id'],
  ['tax', 'id'],
  ['social', 'security'],
  ['credit', 'card'],
  ['card', 'number'],
  ['cc', 'number'],
  ['account', 'number'],
  ['routing', 'number'],
  ['bank', 'account'],
  ['driver', 'license'],
  ['drivers', 'license'],
  ['driving', 'licence'],
  ['license', 'number'],
  ['licence', 'number'],
];

// Credentials. A numeric column with one of these names is a counter ("tokens_used"), not a
// secret, so these words only count on non-numeric columns.
const CREDENTIAL_WORDS = new Set([
  'token',
  'secret',
  'password',
  'passwd',
  'pwd',
  'passcode',
  'salt',
  'otp',
  'cvv',
  'cvc',
  'apikey',
]);

const CREDENTIAL_PHRASES = [
  ['api', 'key'],
  ['access', 'key'],
  ['private', 'key'],
  ['secret', 'key'],
];

const NUMERIC = /^(smallint|integer|bigint|numeric|decimal|real|double precision)\b/;

export function columnWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

export function isSensitiveColumn(name: string, type: string): boolean {
  if (type === 'boolean') {
    return false;
  }
  const words = columnWords(name);
  if (matches(words, PERSONAL_WORDS, PERSONAL_PHRASES)) {
    return true;
  }
  return !NUMERIC.test(type) && matches(words, CREDENTIAL_WORDS, CREDENTIAL_PHRASES);
}

function matches(words: string[], single: Set<string>, phrases: string[][]): boolean {
  if (words.some((word) => single.has(word))) {
    return true;
  }
  return phrases.some((phrase) =>
    words.some((_, start) =>
      phrase.every((part, offset) => words[start + offset] === part),
    ),
  );
}
