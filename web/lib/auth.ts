import { betterAuth } from 'better-auth';
import { Pool }        from 'pg';


const dbUrl = new URL(process.env.DATABASE_URL!);
dbUrl.searchParams.delete('sslmode');

const pool = new Pool({
  connectionString: dbUrl.toString(),
  ssl: dbUrl.hostname.includes('localhost') ? undefined : { rejectUnauthorized: false },
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