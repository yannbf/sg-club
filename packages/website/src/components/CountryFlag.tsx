import Tooltip from "./Tooltip";

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

const getCountryName = (countryCode: string | null | undefined) => {
  return countryCode ? (countryNames.of(countryCode.toUpperCase()) || countryCode.toUpperCase()) : 'Country info not available';
}

const CountryFlag = ({ countryCode }: { countryCode: string | null | undefined }) => {
  const src = countryCode ? `https://flagcdn.com/24x18/${countryCode}.png` : 'https://friconix.com/jpg/fi-snsuxl-question-mark.jpg';

  const alt = countryCode ?? 'country info not available';

  return (
    <Tooltip content={getCountryName(countryCode)}>
      <div className="flex items-center">
        <img width={24} height={18} src={src} alt={alt} className="ml-2 text-2xl text-muted-foreground" />
      </div>
    </Tooltip>
  )
}

export default CountryFlag;