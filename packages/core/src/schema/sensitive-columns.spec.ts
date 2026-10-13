import { columnWords, isSensitiveColumn } from './sensitive-columns';

// [column name, format_type output, flagged as sensitive]
const cases: Array<[string, string, boolean]> = [
  ['email', 'text', true],
  ['customer_email', 'text', true],
  ['customerEmail', 'character varying(255)', true],
  ['EmailAddress', 'text', true],
  ['phone', 'text', true],
  ['mobile_number', 'text', true],
  ['phone', 'bigint', true],
  ['home_address', 'text', true],
  ['ip_address', 'inet', true],
  ['ssn', 'text', true],
  ['ssn', 'integer', true],
  ['passport_no', 'text', true],
  ['aadhaar_number', 'text', true],
  ['pan', 'text', true],
  ['national_id', 'text', true],
  ['tax_id', 'text', true],
  ['date_of_birth', 'date', true],
  ['birth_date', 'date', true],
  ['dob', 'date', true],
  ['credit_card_number', 'text', true],
  ['cardNumber', 'text', true],
  ['iban', 'text', true],
  ['bank_account', 'text', true],
  ['drivers_license', 'text', true],
  ['password_hash', 'text', true],
  ['api_key', 'text', true],
  ['apiKey', 'text', true],
  ['refresh_token', 'text', true],
  ['client_secret', 'bytea', true],
  ['totp_secret', 'text', true],
  ['otp', 'character(6)', true],

  ['id', 'integer', false],
  ['name', 'text', false],
  ['region', 'text', false],
  ['city', 'text', false],
  ['country', 'text', false],
  ['sku', 'text', false],
  ['unit_price', 'numeric(12,2)', false],
  ['tax_amount', 'numeric(12,2)', false],
  ['vat', 'numeric(12,2)', false],
  ['pin_code', 'text', false],
  ['category', 'text', false],
  ['syntax_identifier', 'text', false],
  ['company', 'text', false],
  ['mail_count', 'integer', false],
  ['tokens_used', 'integer', false],
  ['token_count', 'bigint', false],
  ['password_attempts', 'smallint', false],
  ['email_opt_in', 'boolean', false],
  ['has_phone', 'boolean', false],
  ['ordered_on', 'date', false],
  ['created_at', 'timestamp with time zone', false],
];

describe('isSensitiveColumn', () => {
  it.each(cases)('%s (%s) -> %s', (name, type, expected) => {
    expect(isSensitiveColumn(name, type)).toBe(expected);
  });
});

describe('columnWords', () => {
  it('splits snake case, camel case, and acronyms into lower-case words', () => {
    expect(columnWords('customer_email')).toEqual(['customer', 'email']);
    expect(columnWords('customerEmailAddress')).toEqual(['customer', 'email', 'address']);
    expect(columnWords('HTTPStatusCode')).toEqual(['http', 'status', 'code']);
    expect(columnWords('Order ID 2')).toEqual(['order', 'id', '2']);
  });
});
