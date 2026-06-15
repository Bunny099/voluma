import { betterAuth } from 'better-auth';
import pool            from './db/pool';

// This instance only validates existing sessions.
// Auth routes (Google OAuth, session creation) live in the Next.js web app.
// Both share the same DATABASE_URL so sessions created in web are visible here.
export const auth = betterAuth({
  database: pool,
  secret:   process.env.BETTER_AUTH_SECRET!,
});