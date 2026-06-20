import nodemailer from 'nodemailer';

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  async sendMail(to, subject, text, html) {
    try {
      await this.transporter.sendMail({
        from: `"Tijucas Imobiliária" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        text,
        html,
      });
    } catch (error) {
      console.error(`Erro interno ao disparar e-mail para ${to}:`, error);
      throw error;
    }
  }

  async sendVerificationEmail(to, code) {
    const subject = 'Confirme seu E-mail';
    const text = `Seu código de verificação é: ${code}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #A69355;">Verificação de E-mail</h2>
        <p>Olá! Seu código de verificação é:</p>
        <h1 style="background-color: #f4f4f4; padding: 10px; border-radius: 5px; display: inline-block; letter-spacing: 5px; color: #333;">${code}</h1>
        <p>Insira este código no aplicativo para continuar e validar sua conta.</p>
        <br>
        <p style="font-size: 12px; color: #999;">Se você não solicitou este código, ignore este e-mail.</p>
      </div>
    `;

    return this.sendMail(to, subject, text, html);
  }
}

export default new EmailService();
