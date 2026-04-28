const unreachable = (): never => {
  throw new Error(
    'Server-only module reached the browser. The visualiser must use null instances.',
  );
};

export const MongoClient = unreachable;
export const ObjectId = unreachable;
export const WebSocketServer = unreachable;
export default unreachable;
