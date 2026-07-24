export interface ValidationResult {
  pass: boolean;
  violations: string[];
}

export class AmazonPolicyChecker {
  static check(listing: { title: string; description: string; price: number; category?: string }): ValidationResult {
    const violations: string[] = [];
    if (listing.title.length > 200) violations.push('标题超过 200 字符');
    if (listing.title.length < 80) violations.push('标题不足 80 字符');
    if (!listing.description || listing.description.length < 100) violations.push('描述不足 100 字符');
    if (listing.price <= 0) violations.push('价格必须大于 0');
    return { pass: violations.length === 0, violations };
  }
}
