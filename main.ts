import { Api, Client, type DMChannel, type HttpResponse } from "traq-bot-ts";
import fs from "node:fs/promises";

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

interface Schedule {
    readonly time: string;
    readonly userId: string;
    readonly content: string;
}

interface Config {
    readonly interval: number;
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
    main();
});

client.on(
    "DIRECT_MESSAGE_CREATED",
    ({
        body: {
            message: { channelId, text, createdAt: _createdAt },
        },
    }) => {
        const createdAt = new Date(_createdAt);
        const latency =
            new Date().getMilliseconds() - createdAt.getMilliseconds();

        console.log(latency);

        if (text.toLowerCase() === "!ping") {
            api.channels.postMessage(channelId, {
                content: `Pong!\n - latency: ${latency}`,
            });
        }
    }
);

const bootedAt = new Date();

async function main() {
    const config = await fetchConfig(CONFIG_PATH);
    console.log(config);

    if (config.interval < 1000) {
        throw new Error("Interval too short");
    }

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

        const {
            data: { id: channelId },
        } = await api.users
            .getUserDmChannel(userId)
            .then((response) => response as HttpResponse<DMChannel>);

        api.channels.postMessage(channelId, { content: content });
    });

    setTimeout(main, config.interval);
}
