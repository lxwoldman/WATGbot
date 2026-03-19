export function getRequestActor(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();

  return {
    username: req.authUser || "anonymous",
    ip: forwardedFor || req.socket?.remoteAddress || "",
    userAgent: req.get?.("user-agent") || ""
  };
}
