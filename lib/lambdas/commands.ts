import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

import { VALHEIM_INSTANCE_ID } from "./utils/aws-clients";
import { InteractionType, InteractionResponseType } from "./commands/types";
import { handleStartCommand } from "./commands/start";
import { handleStopCommand } from "./commands/stop";
import { handleStatusCommand } from "./commands/status";
import { handleWorldsCommand } from "./commands/worlds";
import { handleModsCommand } from "./commands/mods";
import { handleBackupCommand } from "./commands/backup";
import { handleHailCommand } from "./commands/hail";
import { handleHelpCommand } from "./commands/help";
import { handleSetupCommand } from "./commands/setup";
import { handleComponentInteraction } from "./commands/component";

const { verifyKey } = require("discord-interactions");

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> {
  // Keep Lambda alive to complete async operations — required for deferred
  // Discord responses to deliver after the initial 3-second ACK.
  context.callbackWaitsForEmptyEventLoop = true;

  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    const signature =
      event.headers["x-signature-ed25519"] ||
      event.headers["X-Signature-Ed25519"];
    const timestamp =
      event.headers["x-signature-timestamp"] ||
      event.headers["X-Signature-Timestamp"];
    const publicKey = process.env.DISCORD_BOT_PUBLIC_KEY;

    if (!signature || !timestamp || !publicKey) {
      console.error("Missing required headers for Discord verification");
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    try {
      const isValidRequest = await verifyKey(
        event.body || "",
        signature,
        timestamp,
        publicKey,
      );
      if (!isValidRequest) {
        return {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid request signature" }),
        };
      }
    } catch (error) {
      console.error("Error during signature verification:", error);
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Signature verification failed" }),
      };
    }

    const body = JSON.parse(event.body || "{}");

    if (body.type === InteractionType.PING) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: InteractionResponseType.PONG }),
      };
    }

    if (!VALHEIM_INSTANCE_ID) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: "❌ Server configuration error: Missing instance ID" },
        }),
      };
    }

    if (body.type === InteractionType.APPLICATION_COMMAND) {
      const { data, guild_id } = body;
      const command = data.name;
      console.log(`Processing command: ${command}`);

      switch (command) {
        case "start": {
          const worldName = data.options?.find(
            (opt: any) => opt.name === "world",
          )?.value;
          return await handleStartCommand(worldName, guild_id);
        }
        case "stop": {
          const force =
            data.options?.find((opt: any) => opt.name === "force")?.value ||
            false;
          return await handleStopCommand(guild_id, force);
        }
        case "status":
          return await handleStatusCommand();
        case "worlds":
          return await handleWorldsCommand(data, guild_id);
        case "backup":
          return await handleBackupCommand(data, guild_id);
        case "hail":
          return await handleHailCommand();
        case "help":
          return await handleHelpCommand();
        case "setup":
          return await handleSetupCommand(body);
        case "mods":
          return await handleModsCommand(data, guild_id);
        default:
          return {
            statusCode: 200,
            body: JSON.stringify({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: "Unknown command. Use /help to see available commands." },
            }),
          };
      }
    }

    if (body.type === InteractionType.MESSAGE_COMPONENT) {
      return await handleComponentInteraction(body);
    }

    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unhandled interaction type" }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}
