function timestamp() {
  return new Date().toISOString();
}

export const logger = {
  info(message, meta) {
    console.log(`[${timestamp()}] INFO ${message}`, meta || "");
  },
  warn(message, meta) {
    console.warn(`[${timestamp()}] WARN ${message}`, meta || "");
  },
  error(message, meta) {
    console.error(`[${timestamp()}] ERROR ${message}`, meta || "");
  }
};
