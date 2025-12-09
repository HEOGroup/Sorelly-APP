import * as Brevo from "@getbrevo/brevo";

let client: Brevo.TransactionalEmailsApi | null = null;

function getClient(): Brevo.TransactionalEmailsApi {
  if (!client) {
    const apiKey = process.env.BREVO_API_KEY;

    if (!apiKey) {
      throw new Error("BREVO_API_KEY ausente – email não enviado.");
    }

    const transactionalClient = new Brevo.TransactionalEmailsApi();

    transactionalClient.setApiKey(
      Brevo.TransactionalEmailsApiApiKeys.apiKey,
      apiKey,
    );

    client = transactionalClient;
  }

  return client;
}

function getErrorStatus(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object"
  ) {
    const response = error.response as { status?: number };
    return response?.status;
  }

  if (error && typeof error === "object" && "statusCode" in error) {
    return (error as { statusCode?: number }).statusCode;
  }

  return undefined;
}

export async function sendVerificationEmail(
  to: string,
  code: string,
): Promise<void> {
  const transactionalClient = getClient();

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Seu Código de Verificação</title>
  <style>
    body { margin: 0; padding: 0; background-color: #000000; font-family: 'Arial', sans-serif; color: #ffffff; }
    table { border-spacing: 0; width: 100%; max-width: 600px; margin: 0 auto; background-color: #000000; }
    td { padding: 0; }
    .header { padding: 30px 20px; text-align: center; border-bottom: 1px solid rgba(178, 138, 36, 0.2); }
    .logo { color: #ffffff; font-size: 24px; font-weight: 300; letter-spacing: 2px; text-decoration: none; display: inline-block; }
    .logo-icon { color: #B28A24; margin-right: 8px; }
    .content { padding: 40px 30px; text-align: center; }
    .title { font-size: 24px; margin-bottom: 20px; color: #ffffff; font-weight: 300; }
    .text { font-size: 16px; line-height: 1.6; color: #939393; margin-bottom: 30px; }
    .code-container { background-color: #262626; border: 1px solid #B28A24; border-radius: 8px; padding: 24px; margin: 30px 0; display: inline-block; min-width: 200px; }
    .code { font-size: 36px; font-weight: bold; color: #ffffff; letter-spacing: 6px; mso-line-height-rule: exactly; line-height: 36px; }
    .footer { padding: 30px 20px; text-align: center; font-size: 16px; color: #555555; border-top: 1px solid #1a1a1a; }
  </style>
</head>
<body>
  <table role="presentation">
    <tr>
      <td class="header">
        <div class="logo"><span class="logo-icon">✦</span>SORELLY</div>
      </td>
    </tr>
    <tr>
      <td class="content">
        <h1 class="title" style="font-size: 24px;">Verificação de Conta</h1>
        <p class="text" style="font-size: 16px;">Use o código abaixo para acessar sua conta.</p>
        
        <div class="code-container">
          <span class="code">${code}</span>
        </div>
        
        <p class="text" style="font-size: 16px;">Este código expira em 10 minutos.</p>
      </td>
    </tr>
    <tr>
      <td class="footer">
        <p>&copy; ${new Date().getFullYear()} Sorelly.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const email = new Brevo.SendSmtpEmail();
  email.sender = {
    email: process.env.BREVO_SENDER_EMAIL ?? "adm@hnoapps.com",
    name: process.env.BREVO_SENDER_NAME ?? "H&O Aplicativos",
  };
  email.to = [{ email: to }];
  email.subject = "Seu código de acesso Sorelly";
  email.htmlContent = htmlContent;

  try {
    await transactionalClient.sendTransacEmail(email);
  } catch (error: any) {
    console.error("Brevo raw error:", JSON.stringify(error, null, 2));
    console.error("Brevo response status:", error?.response?.status);
    console.error("Brevo response data:", error?.response?.data);

    const status = getErrorStatus(error);

    if (status === 401) {
      throw new Error(
        "Falha ao enviar email: verifique a chave, IP autorizado e status da conta na Brevo.",
      );
    }

    console.error("Falha ao enviar email de verificação:", error);
    throw new Error("Falha ao enviar email de verificação.");
  }
}
