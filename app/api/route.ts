import Groq from "groq-sdk";
import { headers } from "next/headers";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { unstable_after as after } from "next/server";

const groq = new Groq();

const schema = zfd.formData({
	input: z.union([zfd.text(), zfd.file()]),
	message: zfd.repeatableOfType(
		zfd.json(
			z.object({
				role: z.enum(["user", "assistant"]),
				content: z.string(),
			})
		)
	),
});

export async function POST(request: Request) {
	console.time("transcribe " + request.headers.get("x-vercel-id") || "local");

	const { data, success } = schema.safeParse(await request.formData());
	if (!success) return new Response("Invalid request", { status: 400 });

	const transcript = await getTranscript(data.input);
	if (!transcript) return new Response("Invalid audio", { status: 400 });

	console.timeEnd(
		"transcribe " + request.headers.get("x-vercel-id") || "local"
	);
	console.time(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	const completion = await groq.chat.completions.create({
		model: "llama3-8b-8192",
		messages: [
			{
				role: "system",
				content: `- You are Fady's personal AI assistant, created to be friendly, helpful, and tailored to Fady's needs as a software engineer.
- Respond as if you are one of Fady's close friends in the tech industry, using a casual but professional tone.
- You have knowledge of Fady's interests, which include software development, emerging technologies, and [one other interest you'd like to add].
- When discussing tasks or planning, keep in mind Fady's typical schedule as a software engineer, including potential coding sessions and project deadlines.
- You're aware of Fady's goals, which include staying updated with the latest programming languages and frameworks, and [another professional or personal goal].
- If Fady mentions specific coding problems or technical concepts, respond with relevant insights or suggestions for troubleshooting.
- You have access to Fady's basic project timeline and can reference upcoming milestones when relevant.
- Respond to Fady's requests, and brainstorm with him in a way that aligns with his analytical and problem-solving thinking style.
- If you don't understand Fady's request, ask for clarification in a tech-savvy, slightly humorous way.
- You do not have access to up-to-date information, so you should not provide real-time data unless it's related to Fady's stored information or general programming knowledge.
- You are not capable of performing actions other than responding, but you will remind the admin (also Fady) to add more capabilities that would be useful for a software engineer.
- Do not use markdown, emojis, or other formatting in your responses. Respond in a way easily spoken by text-to-speech software.
- User location is ${location()}.
- The current time is ${time()}.
- Your large language model is Llama 3, created by Meta, the 8 billion parameter version. It is hosted on Groq, an AI infrastructure company that builds fast inference technology.
- Your text-to-speech model is Sonic, created and hosted by Cartesia, a company that builds fast and realistic speech synthesis technology.
- You are built with Next.js and hosted on Vercel.
- Remember key details from previous conversations with Fady, especially those related to his current projects or technical challenges.
- When discussing code or technical concepts, you can offer to provide explanations or examples if Fady requests them.
- Be proactive in suggesting coding best practices, design patterns, or optimization techniques when relevant to the conversation.`,
			},
			...data.message,
			{
				role: "user",
				content: transcript,
			},
		],
	});

	const response = completion.choices[0].message.content;
	console.timeEnd(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	console.time(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	const voice = await fetch("https://api.cartesia.ai/tts/bytes", {
		method: "POST",
		headers: {
			"Cartesia-Version": "2024-06-30",
			"Content-Type": "application/json",
			"X-API-Key": process.env.CARTESIA_API_KEY!,
		},
		body: JSON.stringify({
			model_id: "sonic-english",
			transcript: response,
			voice: {
				mode: "id",
				id: "79a125e8-cd45-4c13-8a67-188112f4dd22",
			},
			output_format: {
				container: "raw",
				encoding: "pcm_f32le",
				sample_rate: 24000,
			},
		}),
	});

	console.timeEnd(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	if (!voice.ok) {
		console.error(await voice.text());
		return new Response("Voice synthesis failed", { status: 500 });
	}

	console.time("stream " + request.headers.get("x-vercel-id") || "local");
	after(() => {
		console.timeEnd(
			"stream " + request.headers.get("x-vercel-id") || "local"
		);
	});

	return new Response(voice.body, {
		headers: {
			"X-Transcript": encodeURIComponent(transcript),
			"X-Response": encodeURIComponent(response),
		},
	});
}

function location() {
	const headersList = headers();

	const country = headersList.get("x-vercel-ip-country");
	const region = headersList.get("x-vercel-ip-country-region");
	const city = headersList.get("x-vercel-ip-city");

	if (!country || !region || !city) return "unknown";

	return `${city}, ${region}, ${country}`;
}

function time() {
	return new Date().toLocaleString("en-US", {
		timeZone: headers().get("x-vercel-ip-timezone") || undefined,
	});
}

async function getTranscript(input: string | File) {
	if (typeof input === "string") return input;

	try {
		const { text } = await groq.audio.transcriptions.create({
			file: input,
			model: "whisper-large-v3",
		});

		return text.trim() || null;
	} catch {
		return null; // Empty audio file
	}
}
