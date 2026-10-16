import { invalidRequest } from '@ayd/core';
import { ValidationPipe, type ValidationError } from '@nestjs/common';

/**
 * The first problem class-validator found, with the path to it for nested fields, such as
 * "tables.0.columns.1.name must be a string". Undefined when nothing has a message.
 */
export function firstValidationMessage(
  errors: ValidationError[],
  parentPath = '',
): string | undefined {
  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    const message = error.constraints ? Object.values(error.constraints)[0] : undefined;
    if (message) {
      // class-validator starts its own messages with the property name; give the full path.
      return parentPath && message.startsWith(error.property)
        ? `${parentPath}.${message}`
        : message;
    }
    const nested = firstValidationMessage(error.children ?? [], path);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

/**
 * Checks every @Body() typed with a DTO class before the controller runs (main.ts and the
 * test app both use it):
 * - whitelist: fields the DTO does not declare are dropped, so a client cannot slip in extras;
 * - transform: the controller receives the DTO instance, with @Transform rules (such as
 *   trimming) applied;
 * - stopAtFirstError: one message per field, from the first rule it breaks;
 * - a failure is the API's own 400 VALIDATION_ERROR, with the first problem as its message.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    stopAtFirstError: true,
    exceptionFactory: (errors) => invalidRequest(firstValidationMessage(errors)),
  });
}
