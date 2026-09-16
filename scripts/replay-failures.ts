import amqp from 'amqplib';
import { z } from 'zod';
const service = z
  .enum(['auth', 'users', 'bets', 'jackpot'])
  .parse(process.argv[2]);
const connection = await amqp.connect(z.url().parse(process.env.BROKER_URL));
try {
  const channel = await connection.createConfirmChannel();
  const source = `jackpot.${service}.failed`;
  const target = `jackpot.${service}`;
  // Bounded snapshot: a poison event cannot create an infinite replay loop.
  const { messageCount } = await channel.checkQueue(source);
  let replayed = 0;
  for (let i = 0; i < messageCount; i++) {
    const message = await channel.get(source, { noAck: false });
    if (!message) break;
    await new Promise<void>((resolve, reject) =>
      channel.sendToQueue(
        target,
        message.content,
        {
          persistent: true,
          contentType: 'application/json',
          headers: { attempt: 0 },
        },
        (error) => (error ? reject(error) : resolve()),
      ),
    );
    channel.ack(message);
    replayed++;
  }
  console.log(JSON.stringify({ service, replayed }));
  await channel.close();
} finally {
  await connection.close();
}
