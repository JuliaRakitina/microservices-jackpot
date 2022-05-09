FROM node:17-alpine as development

RUN apk update
RUN apk add protobuf
ENV NODE_ENV=development
COPY ./jackpot-srv /app
COPY package*.json /app
WORKDIR /app

RUN npm install
COPY ./rp-proto /app/rp-proto
WORKDIR /app
RUN npm install rp-proto/
RUN protoc --plugin=/app/node_modules/.bin/protoc-gen-ts_proto -I=/app/node_modules/rp-proto/proto --ts_proto_out=src/jackpot/proto /app/node_modules/rp-proto/proto/jackpot.proto --ts_proto_opt=nestJs=true --ts_proto_opt=fileSuffix=.pb --ts_proto_opt=esModuleInterop=true

RUN npm run build

CMD ["node", "dist/main"]
