export interface CsvDataItem {
  ["Website URL"]: string;
  ["Record ID"]: string;
  name: string;
  links?: string;
  Alive?: string;
  ["Business type"]?: string;
  ["Business model"]?: string;

  [key: string]: any;
}
