export interface ActionPrimitive {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(params: Record<string, unknown>, context?: { departmentId?: string; userId?: string }): Promise<ActionResult>;
}

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresApproval?: boolean;
}

export interface ListingData {
  title: string;
  description: string;
  price: number;
  images?: string[];
  category?: string;
  keywords?: string[];
}

export interface ListingResult {
  listingId: string;
  status: 'draft' | 'published' | 'pending_approval';
  url?: string;
  warnings?: string[];
}

export class AmazonListingAction implements ActionPrimitive {
  name = 'amazon_listing';
  description = '在 Amazon 上发布商品列表';
  inputSchema = {
    type: 'object',
    properties: {
      title: { type: 'string', description: '商品标题' },
      description: { type: 'string', description: '商品描述' },
      price: { type: 'number', description: '价格' },
      category: { type: 'string', description: '分类' },
      keywords: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'description', 'price'],
  };

  async execute(params: Record<string, unknown>, context?: { departmentId?: string; userId?: string }): Promise<ActionResult> {
    try {
      const data = params as unknown as ListingData;

      if (!data.title || !data.description || !data.price) {
        return { success: false, error: '缺少必填字段: title, description, price' };
      }

      if (data.price < 0) {
        return { success: false, error: '价格不能为负数' };
      }

      if (data.price > 1000) {
        return {
          success: false,
          error: `商品价格 ¥${data.price} 超过 ¥1000 限额，需要用户审批`,
          requiresApproval: true,
        };
      }

      const result: ListingResult = {
        listingId: `amz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        status: 'published',
        url: `https://amazon.mock/listings/${data.title.substring(0, 20).replace(/\s+/g, '-')}`,
        warnings: [],
      };

      console.log(`[AmazonListingAction] MOCK: 商品 "${data.title}" 已发布, ID=${result.listingId}`);

      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
