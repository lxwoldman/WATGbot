export function ok(res, data = {}, status = 200) {
  res.status(status).json({ ok: true, data });
}

export function fail(res, message, status = 400, details) {
  res.status(status).json({
    ok: false,
    error: {
      message,
      details: details || null
    }
  });
}
