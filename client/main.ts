import { ClientSocket } from './clientSocket.ts';

const client = ClientSocket.create('ws://localhost:9876');
client
  .connect()
  .then(() => {
    console.log('Connected to server');
  })
  .catch((err: unknown) => {
    console.error('Failed to connect to server:', err);
  });

const app = document.getElementById('app');
if (app) {
  app.textContent = 'EkoLite is running.';
  app.textContent = `Client connection:  ${client.isConnected ? 'ON' : 'OFF'}`;
}
