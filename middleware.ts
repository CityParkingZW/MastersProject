import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login']
const API_PATHS    = ['/api']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public and API routes through
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next()
  if (API_PATHS.some(p => pathname.startsWith(p)))    return NextResponse.next()

  // Check for Firebase auth session cookie
  const session = req.cookies.get('__session')?.value
  if (!session) {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.*|apple-icon.*).*)'],
}
