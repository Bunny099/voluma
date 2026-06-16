import { betterAuth } from 'better-auth';
import { Pool }        from 'pg';

console.log("AUTH FILE LOADED");

const dbUrl = process.env.DATABASE_URL ?? "";

console.log(
  "DATABASE HOST:",
  dbUrl.split("@")[1]?.split("/")[0]
);

console.log(
  "NODE_ENV:",
  process.env.NODE_ENV
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export const auth = betterAuth({
  database: pool,
  secret:   process.env.BETTER_AUTH_SECRET!,


  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',

  socialProviders: {
    google: {
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, 
    updateAge: 60 * 60 * 24,    
  },

  
  trustedOrigins: [
    process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  ],
});