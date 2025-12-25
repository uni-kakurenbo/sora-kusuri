import {
    Api,
    Client,
    type DMChannel,
    type HttpResponse,
    type Message,
    type User,
} from "traq-bot-ts";
import fs from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

const client = new Client({ token: process.env.BOT_ACCESS_TOKEN });
const api = new Api({
    baseApiParams: {
        headers: { Authorization: `Bearer ${process.env.BOT_ACCESS_TOKEN}` },
    },
});

async function fetchConfig(path: string) {
    if (path.startsWith("http")) {
        return (await fetch(CONFIG_PATH).then((response) =>
            response.json()
        )) as Config;
    } else {
        const file = await fs.readFile(path);
        return JSON.parse(file.toString()) as Config;
    }
}

function toTimeDisplay(date: Date) {
    return date.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

async function fetchLogMessage(messageId: string) {
    let retry = 40;
    let hits: Message[] = [];
    do {
        const { data } = await api.messages.searchMessages({
            in: adminDmChannelId,
            bot: true,
            word: messageId,
            sort: "-createdAt",
        });
        hits = data.hits;
        if (hits[0]) break;

        await setTimeout(3 * 1000);
    } while (retry-- > 0);

    return hits[0];
}

interface Schedule {
    readonly time: string;
    readonly userId: string;
    readonly content: string;
}

interface Config {
    readonly interval: number;
    readonly adminId: string;
    readonly schedules: Schedule[];
}

const CONFIG_PATH = process.env.CONFIG_PATH as string;

let lastSentAt: Date[] = [];

function getEndOfDate(date: Date = new Date()) {
    date.setDate(date.getDate() + 1);
    date.setHours(0);
    date.setMinutes(0);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date;
}

client.listen(() => {
    console.log("Listening...");

    setInterval(main, config.interval);
});

const config = await fetchConfig(CONFIG_PATH);

if (config.interval < 1000) {
    throw new Error("Interval too short");
}

const {
    data: { id: adminDmChannelId },
} = await api.users.getUserDmChannel(config.adminId);

const bootedAt = new Date();

function main() {
    while (lastSentAt.length < config.schedules.length) {
        lastSentAt.push(bootedAt);
    }

    const now = new Date();
    console.log(now, lastSentAt);

    config.schedules.forEach(async ({ time, userId, content }, index) => {
        const nextDate = new Date(`${now.toDateString()} ${time}`);
        if (now <= nextDate) return;

        const lastSent = lastSentAt[index]!;
        if (nextDate <= lastSent) return;

        lastSentAt[index] = getEndOfDate(nextDate);

        api.users.postDirectMessage(userId, { content });

        const {
            data: { name: userName },
        } = await api.users.getUser(userId);

        api.users.postDirectMessage(config.adminId, {
            content: `to: @${userName}\n> ${content.split("\n").join("\n> ")}`,
            embed: true,
        });
    });
}

client.on(
    "DIRECT_MESSAGE_CREATED",
    ({
        body: {
            message: {
                id,
                text,
                channelId,
                user: { name: userName },
                createdAt,
            },
        },
    }) => {
        const latency =
            new Date().getMilliseconds() - createdAt.getMilliseconds();

        if (text.toLowerCase() === "!ping") {
            return api.channels.postMessage(channelId, {
                content: `Pong!\n - latency: ${latency}`,
            });

            return;
        }

        api.users.postDirectMessage(config.adminId, {
            content: `from: @${userName} [\`${id}\`]\n\n\nat: ${toTimeDisplay(
                createdAt
            )}\n > ${text}\n\n`,
            embed: true,
        });
    }
);

client.on(
    "DIRECT_MESSAGE_DELETED",
    async ({
        body: {
            message: { id },
            eventTime,
        },
    }) => {
        const message = await fetchLogMessage(id);
        if (message) {
            const { id, content } = message;

            api.messages.editMessage(id, {
                content: `${content}\nat: ${toTimeDisplay(
                    eventTime
                )}\n> _(deleted)_`,
            });

            return;
        }

        api.users.postDirectMessage(config.adminId, {
            content: `deleted: ${id}`,
        });
    }
);

client.on(
    "DIRECT_MESSAGE_UPDATED",

    async ({
        body: {
            message: { id, text, updatedAt },
        },
    }) => {
        const message = await fetchLogMessage(id);

        if (message) {
            const { id, content } = message;

            api.messages.editMessage(id, {
                content: `${content}\nat: ${toTimeDisplay(
                    updatedAt
                )}\n> ${text}\n\n`,
            });

            return;
        }

        api.users.postDirectMessage(config.adminId, {
            content: `updated: ${id}\n> ${text}`,
        });
    }
);
