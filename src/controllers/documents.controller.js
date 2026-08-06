import { z } from 'zod';
import DocumentsService from '../services/documents.service.js';

const documentSchema = z.object({
  tipo: z.enum([
    'CPF',
    'COMPROVANTE_RENDA',
    'SEGUNDO_TITULAR',
    'COMPROVANTE_RESIDENCIA_ANTERIOR',
    'OUTRO',
  ]),
  nomeArquivo: z.string().trim().min(1).max(255),
  key: z.string().min(1),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  tamanhoBytes: z.number().int().positive().max(10 * 1024 * 1024).optional(),
});

const reviewSchema = z.object({
  status: z.enum(['EM_ANALISE', 'APROVADO', 'REPROVADO']),
  observacao: z.string().trim().max(1000).optional(),
}).superRefine((data, context) => {
  if (data.status === 'REPROVADO' && !data.observacao) {
    context.addIssue({ code: 'custom', path: ['observacao'], message: 'Informe o motivo da reprovação.' });
  }
});

class DocumentsController {
  async list(request, response, next) {
    try {
      const data = await DocumentsService.list(request.params.usuarioId, request.user);
      return response.status(200).json({ status: 'success', data });
    } catch (error) { next(error); }
  }

  async create(request, response, next) {
    try {
      const payload = documentSchema.parse(request.body);
      const data = await DocumentsService.create(
        request.params.usuarioId,
        payload,
        request.user
      );
      return response.status(201).json({ status: 'success', data });
    } catch (error) { next(error); }
  }

  async review(request, response, next) {
    try {
      const payload = reviewSchema.parse(request.body);
      const data = await DocumentsService.review(request.params.id, payload, request.user);
      return response.status(200).json({ status: 'success', data });
    } catch (error) { next(error); }
  }

  async myNotifications(request, response, next) {
    try {
      const data = await DocumentsService.listNotifications(request.user);
      return response.status(200).json({ status: 'success', data });
    } catch (error) { next(error); }
  }

  async readNotification(request, response, next) {
    try {
      const data = await DocumentsService.markNotificationRead(request.params.id, request.user);
      return response.status(200).json({ status: 'success', data });
    } catch (error) { next(error); }
  }
}

export default new DocumentsController();
