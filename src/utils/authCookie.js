const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'tijucas_session';
const MAX_AGE_MS = 8 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.AUTH_COOKIE_SAME_SITE || 'lax',
    maxAge: MAX_AGE_MS,
    path: '/',
  };
}

export function setAuthCookie(response, token) {
  response.cookie(COOKIE_NAME, token, cookieOptions());
}

export function clearAuthCookie(response) {
  const { maxAge: _maxAge, ...options } = cookieOptions();
  response.clearCookie(COOKIE_NAME, options);
}

export function getAuthCookieName() {
  return COOKIE_NAME;
}
