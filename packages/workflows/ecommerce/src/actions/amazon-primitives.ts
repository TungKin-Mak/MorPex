/**
 * Amazon ActionPrimitive 标准实现（理想架构第 9 层）
 *
 * 包装 legacy ActionHandler（actions/amazon.ts），
 * 提供 canHandle + execute 标准接口供 DomainPrimitiveRegistry 使用。
 */
import type { ActionPrimitive, ActionResult } from '@morpex/core';
import { createListing, uploadImage, updatePrice } from '../../actions/amazon.js';

export class CreateListingAction implements ActionPrimitive {
  name = 'amazon.create_listing';
  description = '在 Amazon 创建商品列表（draft）';
  inputSchema = {
    type: 'object',
    properties: {
      title: { type: 'string', description: '商品标题' },
      price: { type: 'number', description: '价格' },
      category: { type: 'string', description: '分类' },
    },
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /amazon|亚马逊|商品|上架|listing|电商/.test(t) ? 0.9 : 0;
  }

  async execute(params: Record<string, unknown>, context?: { departmentId?: string }): Promise<ActionResult> {
    return createListing.execute(params, context as Record<string, unknown> | undefined);
  }
}

export class UploadImageAction implements ActionPrimitive {
  name = 'amazon.upload_image';
  description = '上传商品图片到 Amazon';
  inputSchema = {
    type: 'object',
    properties: {
      imagePath: { type: 'string', description: '图片路径' },
      listingId: { type: 'string', description: '商品列表 ID' },
    },
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /图片|image|upload|上传/.test(t) && /amazon|亚马逊|商品/.test(t) ? 0.85 : 0;
  }

  async execute(params: Record<string, unknown>, context?: { departmentId?: string }): Promise<ActionResult> {
    return uploadImage.execute(params, context as Record<string, unknown> | undefined);
  }
}

export class UpdatePriceAction implements ActionPrimitive {
  name = 'amazon.update_price';
  description = '更新 Amazon 商品价格';
  inputSchema = {
    type: 'object',
    properties: {
      listingId: { type: 'string', description: '商品列表 ID' },
      price: { type: 'number', description: '新价格' },
    },
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /价格|price|定价|改价/.test(t) && /amazon|亚马逊|商品/.test(t) ? 0.85 : 0;
  }

  async execute(params: Record<string, unknown>, context?: { departmentId?: string }): Promise<ActionResult> {
    return updatePrice.execute(params, context as Record<string, unknown> | undefined);
  }
}
