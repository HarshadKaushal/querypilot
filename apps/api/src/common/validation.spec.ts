import { AppException } from '@ayd/core';
import type { ArgumentMetadata, Type } from '@nestjs/common';
import { DevLoginDto } from '../auth/sign-in/dev-login.dto';
import { UpdateConnectionDto } from '../connections/connection.dto';
import { AskQuestionDto, RunSqlDto } from '../jobs/jobs.dto';
import { UpdateAllowlistDto } from '../schema/allowlist.dto';
import { createValidationPipe } from './validation';

const pipe = createValidationPipe();

/** What Nest passes the pipe for a parameter declared as @Body() body: <metatype>. */
function asBody(metatype: Type<unknown>): ArgumentMetadata {
  return { type: 'body', metatype, data: undefined };
}

/** The error the pipe throws for this body, or a failure if it accepts it. */
async function rejection(value: unknown, metatype: Type<unknown>): Promise<AppException> {
  try {
    await pipe.transform(value, asBody(metatype));
  } catch (error) {
    return error as AppException;
  }
  throw new Error('The pipe accepted a body it should refuse');
}

const QUESTION_REQUIRED = 'Send the question as a non-empty "question" string.';
const SQL_REQUIRED = 'Send the SQL to run as a non-empty "sql" string.';

describe('validation pipe', () => {
  it('trims the question and drops fields the DTO does not declare', async () => {
    const result = await pipe.transform(
      { question: '  How many orders?  ', userId: 'someone-else' },
      asBody(AskQuestionDto),
    );
    expect(result).toBeInstanceOf(AskQuestionDto);
    expect({ ...result }).toEqual({ question: 'How many orders?' });
  });

  it.each([
    [{}, QUESTION_REQUIRED],
    [{ question: 7 }, QUESTION_REQUIRED],
    [{ question: '   ' }, QUESTION_REQUIRED],
    [{ question: 'x'.repeat(2001) }, 'The question is longer than 2000 characters.'],
  ])('refuses a bad question with a specific message (%#)', async (value, message) => {
    const error = await rejection(value, AskQuestionDto);
    expect(error).toBeInstanceOf(AppException);
    expect(error.getStatus()).toBe(400);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', message });
  });

  it('keeps the SQL exactly as written, and refuses SQL that is not text', async () => {
    const result = await pipe.transform({ sql: '  SELECT 1  ' }, asBody(RunSqlDto));
    expect({ ...result }).toEqual({ sql: '  SELECT 1  ' });
    expect(await rejection({ sql: 42 }, RunSqlDto)).toMatchObject({
      message: SQL_REQUIRED,
    });
  });

  it('names the path to a problem inside the allowlist', async () => {
    const error = await rejection(
      {
        version: 1,
        tables: [{ schema: 'public', name: 'orders', columns: [{ name: 5 }] }],
      },
      UpdateAllowlistDto,
    );
    expect(error.message).toBe('tables.0.columns.0.name must be a string');
    expect(
      (await rejection({ version: 1, tables: 'orders' }, UpdateAllowlistDto)).message,
    ).toBe('tables must be an array');
  });

  it('accepts a partial connection update, but not a port sent as text', async () => {
    await expect(
      pipe.transform({ label: 'Renamed' }, asBody(UpdateConnectionDto)),
    ).resolves.toEqual({ label: 'Renamed' });
    expect((await rejection({ port: '5433' }, UpdateConnectionDto)).message).toBe(
      'port must be an integer number',
    );
  });

  it('treats a missing dev-login body as empty, so the defaults apply', async () => {
    await expect(pipe.transform(undefined, asBody(DevLoginDto))).resolves.toEqual({});
  });
});
