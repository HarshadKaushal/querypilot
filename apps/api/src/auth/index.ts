// What the rest of the API uses from auth. Other folders import from '../auth', not from
// the files inside it, so auth can be reorganised without touching them.
//
//   protect-routes/  is this request signed in, and who is it (the guard and @CurrentUser)
//   sign-in/         the /v1/auth/* routes: Google and dev login, refresh, logout
//   tokens/          access tokens, refresh tokens, and the sealed OAuth cookie
//   storage/         reading and writing users and refresh tokens

export { AuthModule } from './auth.module';
export { AuthGuard } from './protect-routes/auth.guard';
export { CurrentUser } from './protect-routes/current-user.decorator';
export type { PublicUser } from './user';
// For the API docs of routes that return a user.
export { PublicUserDto } from './user';
// For account deletion in the users controller.
export { AuthService } from './sign-in/auth.service';
