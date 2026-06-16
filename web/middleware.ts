import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  
  const sessionCookie =
  request.cookies.get('__Secure-better-auth.session_token') ??
  request.cookies.get('better-auth.session_token');;

  if (!sessionCookie?.value) {
   
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};