import crypto from "node:crypto";

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAccessAuthEnabled(config = {}) {
  return Boolean(config.username && config.password);
}

export function parseBasicAuthHeader(headerValue) {
  const header = String(headerValue || "");
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) {
    return null;
  }

  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

export function verifyAccessCredentials(credentials, config = {}) {
  if (!isAccessAuthEnabled(config)) {
    return { ok: true, username: "anonymous" };
  }

  if (!credentials) {
    return { ok: false, reason: "missing_credentials" };
  }

  const usernameMatches = safeEqual(credentials.username, config.username);
  const passwordMatches = safeEqual(credentials.password, config.password);
  if (!usernameMatches || !passwordMatches) {
    return { ok: false, reason: "invalid_credentials" };
  }

  return { ok: true, username: credentials.username };
}

export function challengeAccess(res) {
  res.setHeader("WWW-Authenticate", 'Basic realm="Broker Console Pro", charset="UTF-8"');
  res.status(401).json({
    ok: false,
    error: {
      message: "Authentication required."
    }
  });
}

export function requireAccessAuth(config = {}) {
  if (!isAccessAuthEnabled(config)) {
    return (req, _res, next) => {
      req.authUser = null;
      next();
    };
  }

  return (req, res, next) => {
    if (req.path === "/api/health") {
      req.authUser = config.username;
      next();
      return;
    }

    const credentials = parseBasicAuthHeader(req.headers.authorization);
    const result = verifyAccessCredentials(credentials, config);
    if (!result.ok) {
      challengeAccess(res);
      return;
    }

    req.authUser = result.username;
    next();
  };
}

export function verifySocketAccess(socket, config = {}) {
  if (!isAccessAuthEnabled(config)) {
    socket.data.authUser = null;
    return true;
  }

  const credentials = parseBasicAuthHeader(socket.handshake.headers.authorization);
  const result = verifyAccessCredentials(credentials, config);
  if (!result.ok) {
    return false;
  }

  socket.data.authUser = result.username;
  return true;
}
