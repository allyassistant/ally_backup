import pdfplumber
import re

round_pdf = "/Users/ally/Desktop/Rapaport/Round Price List 01.30.2026.pdf"
pear_pdf = "/Users/ally/Desktop/Rapaport/Pear Price List 01.30.2026.pdf"

def get_price_from_pdf(pdf_path, carat, color, clarity, discount, shape_name):
    """Extract price from Rapaport PDF"""
    
    # Determine carat range
    if 3.00 <= carat <= 3.99:
        target_range = ("3.00", "3.99")
    elif 4.00 <= carat <= 4.99:
        target_range = ("4.00", "4.99")
    elif 5.00 <= carat <= 5.99:
        target_range = ("5.00", "5.99")
    elif 1.00 <= carat <= 1.49:
        target_range = ("1.00", "1.49")
    elif 1.50 <= carat <= 1.99:
        target_range = ("1.50", "1.99")
    else:
        return None, "Carat range not supported"
    
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            
            # Check if this page has our target range
            if target_range[0] in text and target_range[1] in text:
                lines = text.split('\n')
                
                in_section = False
                for line in lines:
                    # Find table header
                    if target_range[0] in line and target_range[1] in line and "CT" in line:
                        in_section = True
                        continue
                    
                    # Stop at next table
                    if in_section:
                        next_range = False
                        for next_r in ["1.00-1.49", "1.50-1.99", "2.00-2.99", "3.00-3.99", "4.00-4.99", "5.00-5.99", "10.00-10.99"]:
                            if next_r.split('-')[0] in line and next_r.split('-')[1] in line:
                                if next_r != f"{target_range[0]}-{target_range[1]}":
                                    next_range = True
                                    break
                        if next_range:
                            break
                    
                    # Look for color row
                    if in_section and line.strip().startswith(f'{color} ') and re.search(r'\d', line):
                        numbers = re.findall(r'\d+', line)
                        if len(numbers) >= 11:
                            clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3']
                            clarity_idx = clarities.index(clarity)
                            rap_value = int(numbers[clarity_idx])
                            
                            # Calculate price
                            list_price_per_ct = rap_value * 100
                            total_list = list_price_per_ct * carat
                            final_price = total_list * (1 - discount)
                            
                            return {
                                'shape': shape_name,
                                'carat': carat,
                                'color': color,
                                'clarity': clarity,
                                'rap_value': rap_value,
                                'list_per_ct': list_price_per_ct,
                                'total_list': total_list,
                                'discount': discount,
                                'final': final_price
                            }, None
    
    return None, "Price not found"

# Query 1: RBC 3.50 E VS1 -40%
print("=" * 70)
print("QUERY 1: RBC 3.50 E VS1 -40%")
print("=" * 70)

result1, err1 = get_price_from_pdf(round_pdf, 3.50, 'E', 'VS1', 0.40, 'RBC')
if result1:
    print(f"Rapaport 3.00-3.99 E VS1: {result1['rap_value']}")
    print(f"List Price/ct: ${result1['list_per_ct']:,}")
    print(f"Total List Price: ${result1['total_list']:,.2f}")
    print(f"Discount: -{int(result1['discount']*100)}%")
    print(f"\n*** FINAL PRICE: USD ${result1['final']:,.2f} ***")
else:
    print(f"Error: {err1}")

# Query 2: PS 5.20 F VVS2 -45%
print("\n" + "=" * 70)
print("QUERY 2: PS 5.20 F VVS2 -45%")
print("=" * 70)

result2, err2 = get_price_from_pdf(pear_pdf, 5.20, 'F', 'VVS2', 0.45, 'PS')
if result2:
    print(f"Rapaport 5.00-5.99 F VVS2: {result2['rap_value']}")
    print(f"List Price/ct: ${result2['list_per_ct']:,}")
    print(f"Total List Price: ${result2['total_list']:,.2f}")
    print(f"Discount: -{int(result2['discount']*100)}%")
    print(f"\n*** FINAL PRICE: USD ${result2['final']:,.2f} ***")
else:
    print(f"Error: {err2}")
