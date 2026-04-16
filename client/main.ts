import { ClientSocket } from './clientSocket.ts';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const url = `${protocol}//${window.location.host}/ws`;

const client = ClientSocket.create(url);
client
  .connect()
  .then(() => {
    console.warn('Connected to server');
    const app = document.getElementById('app');
    if (app) {
      app.textContent = `EkoLite is running. Connection: ${client.isConnected ? 'ON' : 'OFF'}`;
    }
  })
  .catch((err: unknown) => {
    console.error('Failed to connect to server:', err);
  });

const app = document.getElementById('app');
if (app) {
  app.textContent = 'EkoLite is running.';
}
