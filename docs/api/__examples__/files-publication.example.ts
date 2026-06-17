import { MongoWrapper } from '../../../server/infrastructure/mongo.ts';
import { Publications } from '../../../server/logic/publications.ts';
import { WebSocketWrapper } from '../../../server/infrastructure/websocket.ts';

// Wire the engine to your infrastructure, then declare the publication the
// client subscribes to. The collection it returns ('files') is the name the
// client's store binds to on ready, not the subscription name.
const publications = new Publications(
  MongoWrapper.create('mongodb://localhost:27017/app'),
  WebSocketWrapper.create(),
);

publications.define('files.byFolder', (params) => ({
  collection: 'files',
  query: { folderId: params?.folderId },
}));
