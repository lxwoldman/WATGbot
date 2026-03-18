export function registerSocket(io, store) {
  io.on("connection", (socket) => {
    socket.emit("bootstrap", store.getSnapshot());
  });
}

export function pushSnapshot(io, store) {
  io.emit("snapshot", store.getSnapshot());
}
