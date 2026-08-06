import DocumentsRepository from '../repositories/documents.repository.js';
import StorageService from './storage.service.js';
import EmailService from './email.service.js';
import AppError from '../errors/AppError.js';
import { normalizePositiveBigintId } from '../utils/ids.js';

const REQUIRED_TYPES = ['CPF', 'COMPROVANTE_RENDA', 'SEGUNDO_TITULAR'];

class DocumentsService {
  assertCanAccess(targetId, actor) {
    if (actor.perfil === 'CLIENTE' && String(actor.userId) !== String(targetId)) {
      throw new AppError('Cliente não encontrado.', 404);
    }
  }

  async list(usuarioId, actor) {
    const id = normalizePositiveBigintId(usuarioId, 'O ID do cliente');
    this.assertCanAccess(id, actor);
    const user = await DocumentsRepository.getUser(id);
    if (!user || user.perfil !== 'CLIENTE' || user.ativo === false) {
      throw new AppError('Cliente não encontrado.', 404);
    }
    const documents = await DocumentsRepository.listByUser(id);
    const checklist = REQUIRED_TYPES.map((tipo) => ({
      tipo,
      documento: documents.find((documento) => documento.tipo === tipo) ?? null,
    }));
    return { cliente: user, checklist, documentos: documents };
  }

  async create(usuarioId, data, actor) {
    const id = normalizePositiveBigintId(usuarioId, 'O ID do cliente');
    this.assertCanAccess(id, actor);
    const user = await DocumentsRepository.getUser(id);
    if (!user || user.perfil !== 'CLIENTE' || user.ativo === false) {
      throw new AppError('Cliente não encontrado.', 404);
    }

    StorageService.assertKeyBelongsToUser(data.key, id, [
      'DOCUMENTO_CLIENTE',
      'COMPROVANTE_RESIDENCIA_ANTERIOR',
    ]);
    const actualFile = await StorageService.assertUploadedObject(data.key, {
      expectedContentType: data.contentType,
      expectedSize: data.tamanhoBytes,
    });
    return DocumentsRepository.create({
      usuarioId: id,
      ...data,
      contentType: actualFile.contentType,
      tamanhoBytes: actualFile.size,
      enviadoPor: actor.userId,
    });
  }

  async review(documentoId, data, actor) {
    const id = normalizePositiveBigintId(documentoId, 'O ID do documento');
    const result = await DocumentsRepository.review({
      documentoId: id,
      ...data,
      analisadoPor: actor.userId,
    });
    if (!result) throw new AppError('Documento não encontrado.', 404);

    if (result.usuario?.email) {
      EmailService.sendMail(
        result.usuario.email,
        result.titulo,
        result.mensagem
      ).catch((error) => {
        console.error('Falha ao enviar notificação de documento:', error);
      });
    }
    return result.documento;
  }

  async listNotifications(actor) {
    return DocumentsRepository.listNotifications(actor.userId);
  }

  async markNotificationRead(id, actor) {
    const notificationId = normalizePositiveBigintId(id, 'O ID da notificação');
    const result = await DocumentsRepository.markNotificationRead(
      notificationId,
      actor.userId
    );
    if (!result) throw new AppError('Notificação não encontrada.', 404);
    return result;
  }
}

export default new DocumentsService();
