export interface ListingJSON {
  title: string;
  description: string;
  price: number;
  images: string[];
  keywords: string[];
}

export interface ProductImage {
  url: string;
  alt: string;
  variant: 'main' | 'gallery' | 'video_thumbnail';
}

export interface KeywordReport {
  keywords: string[];
  searchVolume: number;
  competition: 'low' | 'medium' | 'high';
}
