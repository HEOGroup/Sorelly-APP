import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  createSession,
  ensureUser,
  findVerification,
  generateVerificationCode,
  markUserAsVerified,
  removeSessionsByUser,
  removeVerification,
  upsertVerification,
  type EnsureUserProfile,
  type UserRecord,
} from "../utils";
import { sendVerificationEmail } from "@/lib/email";

type ResellerRecord = {
  id?: string | number;
  nome?: string | null;
  nome_fantasia?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Payload inválido. Envie um objeto JSON." },
        { status: 400 },
      );
    }

    const email = typeof body.email === "string" ? body.email.trim() : "";
    const code =
      typeof body.code === "string" && body.code.trim().length > 0
        ? body.code.trim()
        : null;

    if (!email) {
      return NextResponse.json(
        { error: "É necessário informar um email válido." },
        { status: 400 },
      );
    }

    // Lógica especial para email de desenvolvedor
    const isDeveloperEmail = email === "developer.hno@gmail.com";

    let resellerProfile: EnsureUserProfile | null;

    if (isDeveloperEmail) {
      resellerProfile = {
        id: 1544,
        name: "Dev. H&O",
      };
    } else {
      resellerProfile = await fetchResellerByEmail(email);

      if (!resellerProfile) {
        return NextResponse.json(
          {
            error: "Nenhuma revendedora encontrada para o email informado.",
          },
          { status: 404 },
        );
      }
    }

    let user!: UserRecord;
    try {
      user = await ensureUser(email, resellerProfile);
    } catch (syncError) {
      return NextResponse.json(
        {
          error: "Não foi possível sincronizar o usuário com a base de dados.",
          details:
            syncError instanceof Error
              ? syncError.message
              : String(syncError),
        },
        { status: 409 },
      );
    }

    if (!code) {
      const token = isDeveloperEmail ? "000000" : generateVerificationCode();
      const verification = await upsertVerification(user.id, token);

      await sendVerificationEmail(user.email, token);

      const includeDebug = shouldExposeVerificationDebug();

      return NextResponse.json(
        {
          message: "Código enviado para o email informado.",
          ...(true
            ? {
              debug: {
                code: verification.token,
                expiresAt: verification.expiresAt,
              },
            }
            : {}),
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
          },
        },
        { status: 200 },
      );
    }

    if (!/^[0-9]{6}$/.test(code)) {
      return NextResponse.json(
        { error: "O código informado é inválido. Utilize 6 dígitos numéricos." },
        { status: 400 },
      );
    }

    const verification = await findVerification(user.id, code);

    if (!verification) {
      return NextResponse.json(
        { error: "Código inválido ou inexistente para este usuário." },
        { status: 400 },
      );
    }

    if (verification.expiresAt.getTime() < Date.now()) {
      await removeVerification(verification.id);

      return NextResponse.json(
        { error: "Código expirado. Solicite um novo código." },
        { status: 400 },
      );
    }

    const shouldMarkAsVerified = !user.isVerified;
    const updatedUser = shouldMarkAsVerified
      ? await markUserAsVerified(user.id)
      : user;
    const finalUser = updatedUser ?? { ...user, isVerified: true };

    await removeSessionsByUser(finalUser.id);

    const sessionToken = randomUUID();
    const session = await createSession(finalUser.id, sessionToken);

    await removeVerification(verification.id);

    return NextResponse.json(
      {
        message: shouldMarkAsVerified
          ? "Conta verificada e sessão iniciada com sucesso."
          : "Código validado e nova sessão iniciada com sucesso.",
        user: finalUser,
        session: {
          token: session.sessionToken,
          expiresAt: session.expiresAt,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Não foi possível processar a solicitação.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

function shouldExposeVerificationDebug() {
  const vercelEnv = process.env.VERCEL_ENV;

  if (vercelEnv) {
    return vercelEnv !== "production";
  }

  return process.env.NODE_ENV !== "production";
}

async function fetchResellerByEmail(
  email: string,
): Promise<EnsureUserProfile | null> {
  const apiToken = process.env.DEVMASTER_API_KEY;

  if (!apiToken) {
    throw new Error(
      "Variável de ambiente DEVMASTER_API_KEY não configurada.",
    );
  }

  const url = `http://portalvps250.indepinfo.com.br:28575/appsorelly/revendedoras/email=${encodeURIComponent(email)}`;
  const response = await fetch(url, {
    headers: { Token: apiToken },
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }

    throw new Error(
      `Falha ao consultar a API externa (${response.status}).`,
    );
  }

  const payload = (await response.json()) as unknown;

  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const record = payload[0] as ResellerRecord;
  const numericId = parseResellerId(record.id);

  if (numericId === null) {
    throw new Error("A API externa retornou um ID inválido para a revendedora.");
  }

  const name =
    typeof record.nome_fantasia === "string" && record.nome_fantasia.trim().length > 0
      ? record.nome_fantasia.trim()
      : typeof record.nome === "string" && record.nome.trim().length > 0
        ? record.nome.trim()
        : null;

  return {
    id: numericId,
    name,
  };
}

function parseResellerId(rawId: ResellerRecord["id"]): number | null {
  if (typeof rawId === "number") {
    return Number.isFinite(rawId) ? rawId : null;
  }

  if (typeof rawId === "string" && rawId.trim().length > 0) {
    const value = Number.parseInt(rawId.trim(), 10);
    return Number.isNaN(value) ? null : value;
  }

  return null;
}
