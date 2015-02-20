/****************************************************************************
 *  Classe:       Modification                                              *
 *  Auteur:       Mariane Maynard                                           *
 *  Description:  Representation d'une modification de l'utilisateur        *
 ****************************************************************************/

#ifndef MODIFICATION
#define MODIFICATION

#include "Fichier.h"
#include "Types.h"

using boost::shared_ptr;
using namespace types;

class Modification
{
  private:
    pos_t _position;
    size_t _taille;
    //uint _versionID;
    
  public:
    Modification() = default;

    Modification(pos_t position, size_t taille)
      : _position{position}
      , _taille{taille}
    {}

    virtual ~Modification() = default;
    virtual pos_t getPosition() const noexcept {return _position;}
    virtual size_t getTaille() const noexcept {return _taille;}
    virtual void effectuerModification(Fichier& fichier) = 0;
};

#endif //MODIFICATION