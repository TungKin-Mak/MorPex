/**
 * Amazon Workflow Actions
 * v15: 每个 action 实现标准 ActionHandler 接口
 */
export interface ActionHandler {
  name: string;
  description: string;
  execute(params: Record<string, unknown>, context?: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }>;
}

export const createListing: ActionHandler = {
  name: 'amazon.create_listing',
  description: '在 Amazon 创建商品列表',
  async execute(params, context) {
    console.log(`[Workflow:Ecommerce] MOCK: amazon.create_listing`, JSON.stringify(params).substring(0, 100));
    return { success: true, data: { listingId: `mock_${Date.now()}`, status: 'draft' } };
  },
};

export const uploadImage: ActionHandler = {
  name: 'amazon.upload_image',
  description: '上传商品图片到 Amazon',
  async execute(params) {
    console.log(`[Workflow:Ecommerce] MOCK: amazon.upload_image`);
    return { success: true, data: { imageUrl: 'https://mock.amazon.com/images/1.jpg' } };
  },
};

export const updatePrice: ActionHandler = {
  name: 'amazon.update_price',
  description: '更新 Amazon 商品价格',
  async execute(params) {
    console.log(`[Workflow:Ecommerce] MOCK: amazon.update_price`);
    return { success: true, data: { price: params.price, updatedAt: Date.now() } };
  },
};
