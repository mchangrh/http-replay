require("dotenv").config();
const fastify = require("fastify")();
const axios = require("axios").default;
// imports
const { version } = require("./package.json");

fastify.register(require("@fastify/redis"), { host: "127.0.0.1" });
fastify.register(require("@fastify/cors"), {
  origin: "*",
  methods: "*",
  allowedHeaders: "*",
});

// taken from cfkv-bin
const SYMBOLS = "23456789abcdefhjkprstxyzABCDEFGHJKMNPQRSTXYZ";
const genID = (len = 5) => {
  let result = "";
  for (let i = 0; i < len; i++)
    result += SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  return result;
};

// static methods for testing
fastify.all("/favicon.ico", (req, reply) => reply.status(404).send());
fastify.all("/ping", (req, reply) => reply.send("pong"));
fastify.all("/version", (req, reply) => reply.send(version));
fastify.all("/pixel.gif", (req, reply) =>
  reply.send(`GIF89a     !ù  ,       L ;`).header("Content-Type", "image/gif")
);
fastify.all("/code/:code/*", (req, reply) =>
  reply.code(Number(req.params.code)).send()
);
fastify.all("/code/:code", (req, reply) =>
  reply.code(Number(req.params.code)).send()
);

// helper
const createReplay = (req) => {
  const { headers, url, method, body, query } = req;
  return {
    url,
    query,
    method,
    body,
    headers,
  };
};

// echo
fastify.all("/echo", (req, reply) => {
  const replay = createReplay(req);
  reply.send(replay).header("Content-Type", "application/json");
});

// create replay
const putReplay = (req, reply) => {
  const { redis } = fastify;
  const id = genID();
  const replay = createReplay(req);
  redis.set(id, JSON.stringify(replay));
  reply.send({ id });
};

const getReplay = (req, reply) => {
  if (!req.params.id) return reply.status(400).send("missing id");
  const { redis } = fastify;
  redis.get(req.params.id, (err, val) => {
    if (err) return reply.send("error ", err);
    if (!val) return reply.status(404).send("not found");
    reply.send(val).header("Content-Type", "application/json");
  });
};

const getReplayBody = (req, reply) => {
  if (!req.params.id) return reply.status(400).send("missing id");
  const { redis } = fastify;
  redis.get(req.params.id, (err, val) => {
    if (err) return reply.send("error ", err);
    if (!val) return reply.status(404).send("not found");
    const replay = JSON.parse(val);
    reply
      .header("content-type", replay.headers["content-type"])
      .header("X-REPLAYED-BY", "mchangrh/http-replay")
      .code(replay.status ?? 200)
      .send(replay.body);
  });
};

const sendReplay = async (req, reply) => {
  // do auth check first
  if (req.query.auth != process.env.AUTH)
    return reply.status(401).send("unauthorized");
  // validation
  if (!req.params.id) return reply.status(400).send("missing id");
  if (!req.query.url) return reply.status(400).send("missing URL");
  // fetch
  const { redis } = fastify;
  let replay;
  await redis.get(req.params.id, (err, val) => {
    if (err) return reply.send("error ", err);
    if (!val) return reply.status(404).send("not found");
    replay = JSON.parse(val);
  });
  // send
  await axios({
    method: replay.method,
    url: req.query.url,
    data: replay.body,
    params: replay.query,
    validateStatus: (status) => true,
  })
    .then((res) => {
      const { redis } = fastify;
      const id = genID();
      const { data, status, headers } = res;
      const replay = { body: data, status, headers };
      redis.set(id, JSON.stringify(replay));
      reply.send({ id, replay });
    })
    .catch((err) => reply.send(err));
};

fastify.all("/replay/put/*", putReplay);
fastify.all("/replay/put", putReplay);

fastify.all("/replay/get/:id", getReplay);
fastify.all("/replay/get/:id/*", getReplay);

fastify.all("/replay/raw/:id", getReplayBody);
fastify.all("/replay/raw/:id/*", getReplayBody);

fastify.all("/replay/send/:id", sendReplay);
fastify.all("/replay/send/:id/*", sendReplay);

fastify.all("/replay", (req, reply) =>
  reply.send(
    "try /replay/put, /replay/get/:id, /replay/raw/:id or /replay/send/:id"
  )
);

fastify.get("*", (req, reply) => reply.send("pong"));

fastify.listen({ port: process.env.PORT });
console.log("server started on port " + process.env.PORT);
